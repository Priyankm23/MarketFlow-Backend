import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { logger, serializeError } from "../../core/utils/logger.js";
import { elasticClient, elasticProductsIndex } from "../../config/elastic.js";

const searchLogger = logger.child({ component: "product-search" });

type ProductWithRelations = {
  id: string;
  categoryId: string;
  vendorId: string;
  name: string;
  description: string;
  price: unknown;
  stock: number;
  reviewCount: number;
  imageUrl: string | null;
  imageUrls: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: { name: string };
  vendor: { businessName: string };
};

type ProductSearchDocument = {
  id: string;
  categoryId: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  reviewCount: number;
  imageUrl: string | null;
  imageUrls: string[];
  isActive: boolean;
  categoryName: string;
  businessName: string;
  createdAt: string;
  updatedAt: string;
};

let isProductsIndexEnsured = false;

function parseNumericValue(value: unknown): number {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  if (value && typeof value === "object" && "toString" in value) {
    const numeric = Number(String(value));
    return Number.isFinite(numeric) ? numeric : 0;
  }

  return 0;
}

function toSearchDocument(
  product: ProductWithRelations,
): ProductSearchDocument {
  return {
    id: product.id,
    categoryId: product.categoryId,
    vendorId: product.vendorId,
    name: product.name,
    description: product.description,
    price: parseNumericValue(product.price),
    stock: product.stock,
    reviewCount: product.reviewCount,
    imageUrl: product.imageUrl,
    imageUrls: product.imageUrls,
    isActive: product.isActive,
    categoryName: product.category.name,
    businessName: product.vendor.businessName,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

async function ensureProductsIndex(): Promise<void> {
  if (isProductsIndexEnsured) {
    return;
  }

  const existsResponse = await elasticClient.indices.exists({
    index: elasticProductsIndex,
  });

  const exists =
    typeof existsResponse === "boolean"
      ? existsResponse
      : Boolean((existsResponse as { body?: unknown }).body);

  if (!exists) {
    await elasticClient.indices.create({
      index: elasticProductsIndex,
      mappings: {
        properties: {
          id: { type: "keyword" },
          categoryId: { type: "keyword" },
          vendorId: { type: "keyword" },
          name: { type: "text" },
          description: { type: "text" },
          categoryName: { type: "text" },
          businessName: { type: "text" },
          price: { type: "float" },
          stock: { type: "integer" },
          reviewCount: { type: "integer" },
          imageUrl: { type: "keyword", index: false },
          imageUrls: { type: "keyword", index: false },
          isActive: { type: "boolean" },
          createdAt: { type: "date" },
          updatedAt: { type: "date" },
        },
      },
    });
  }

  isProductsIndexEnsured = true;
}

async function getProductForIndexing(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: { select: { name: true } },
      vendor: { select: { businessName: true } },
    },
  }) as Promise<ProductWithRelations | null>;
}

export async function syncProductToSearchIndex(
  productId: string,
): Promise<void> {
  try {
    await ensureProductsIndex();

    const product = await getProductForIndexing(productId);
    if (!product) {
      return;
    }

    if (!product.isActive) {
      await elasticClient.delete({
        index: elasticProductsIndex,
        id: product.id,
      });
      return;
    }

    const document = toSearchDocument(product);

    await elasticClient.index({
      index: elasticProductsIndex,
      id: product.id,
      document,
      refresh: false,
    });
  } catch (error) {
    searchLogger.warn(
      {
        err: serializeError(error),
        productId,
      },
      "Failed to sync product in Elasticsearch",
    );
  }
}

export async function searchProductsInIndex(options: {
  query: string;
  page: number;
  limit: number;
}) {
  const { query, page, limit } = options;
  const from = (page - 1) * limit;

  try {
    await ensureProductsIndex();

    const response = await elasticClient.search<ProductSearchDocument>({
      index: elasticProductsIndex,
      from,
      size: limit,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: [
                  "name^4",
                  "categoryName^2",
                  "businessName^2",
                  "description",
                ],
                fuzziness: "AUTO",
                operator: "and",
              },
            },
          ],
          filter: [{ term: { isActive: true } }],
        },
      },
      sort: [{ _score: { order: "desc" } }, { createdAt: { order: "desc" } }],
    });

    const payload = response as {
      hits?: {
        hits?: Array<{ _source?: ProductSearchDocument }>;
        total?: { value: number } | number;
      };
      body?: {
        hits?: {
          hits?: Array<{ _source?: ProductSearchDocument }>;
          total?: { value: number } | number;
        };
      };
    };

    const hits = payload.hits?.hits ?? payload.body?.hits?.hits ?? [];
    const totalRaw = payload.hits?.total ?? payload.body?.hits?.total ?? 0;
    const total = typeof totalRaw === "number" ? totalRaw : totalRaw.value;

    return {
      data: hits
        .map((hit) => hit._source)
        .filter((doc): doc is ProductSearchDocument => Boolean(doc)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    };
  } catch (error) {
    searchLogger.error(
      {
        err: serializeError(error),
      },
      "Elasticsearch search failed",
    );
    throw new ApiError(503, "Product search is currently unavailable");
  }
}

export async function syncAllActiveProductsToSearchIndex(
  batchSize = 200,
): Promise<{ synced: number }> {
  await ensureProductsIndex();

  let synced = 0;
  let cursor: string | undefined;

  while (true) {
    const products = (await prisma.product.findMany({
      where: { isActive: true },
      include: {
        category: { select: { name: true } },
        vendor: { select: { businessName: true } },
      },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    })) as ProductWithRelations[];

    if (products.length === 0) {
      break;
    }

    const operations = products.flatMap((product) => {
      const document = toSearchDocument(product);
      return [
        { index: { _index: elasticProductsIndex, _id: product.id } },
        document,
      ];
    });

    const bulkResponse = await elasticClient.bulk({
      operations,
      refresh: false,
    });

    const hasErrors =
      typeof bulkResponse === "object" &&
      bulkResponse !== null &&
      "errors" in bulkResponse &&
      Boolean((bulkResponse as { errors?: boolean }).errors);

    if (hasErrors) {
      searchLogger.warn(
        {
          details: bulkResponse,
        },
        "Bulk sync completed with Elasticsearch errors",
      );
    }

    synced += products.length;
    cursor = products[products.length - 1]?.id;
  }

  return { synced };
}

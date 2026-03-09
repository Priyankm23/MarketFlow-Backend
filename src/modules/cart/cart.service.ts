import { redis } from "../../config/redis.js";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";

export interface RedisCartItem {
  productId: string;
  quantity: number;
}

export class CartService {
  private static getCartKey(userId: string) {
    return `cart:${userId}`;
  }

  /**
   * Retrieves the cart from Redis and enriches it with real-time DB prices & stock
   */
  static async getCart(userId: string) {
    const key = this.getCartKey(userId);
    const cartData = await redis.get(key);

    let items: RedisCartItem[] = cartData ? JSON.parse(cartData) : [];

    if (items.length === 0) {
      return { items: [], totalAmount: 0 };
    }

    // Fetch live product data from DB
    const productIds = items.map((item) => item.productId);
    const liveProducts = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      include: {
        vendor: { select: { businessName: true } },
      },
    });

    const productMap = new Map(liveProducts.map((p) => [p.id, p]));
    const enrichedItems = [];
    let totalAmount = 0;
    let cartModified = false; // Tracks if we need to auto-correct the redis cart

    const validRedisItems: RedisCartItem[] = [];

    for (const item of items) {
      const liveProduct = productMap.get(item.productId);

      // If product is deleted or innactive, remove from cart
      if (!liveProduct) {
        cartModified = true;
        continue;
      }

      // Enforce stock limits
      let finalQuantity = item.quantity;
      if (finalQuantity > liveProduct.stock) {
        finalQuantity = liveProduct.stock; // Auto-adjust to max avaliable
        cartModified = true;
      }

      // If stock is 0, omit from valid items
      if (finalQuantity > 0) {
        validRedisItems.push({
          productId: liveProduct.id,
          quantity: finalQuantity,
        });

        const itemTotal = Number(liveProduct.price) * finalQuantity;
        totalAmount += itemTotal;

        enrichedItems.push({
          productId: liveProduct.id,
          name: liveProduct.name,
          vendorId: liveProduct.vendorId,
          vendorName: liveProduct.vendor.businessName,
          price: Number(liveProduct.price),
          stock: liveProduct.stock,
          quantity: finalQuantity,
          imageUrl: liveProduct.imageUrl,
          itemTotal,
        });
      } else {
        cartModified = true;
      }
    }

    // If items were removed or adjusted due to stock/deletions, update Redis silently
    if (cartModified) {
      if (validRedisItems.length === 0) {
        await redis.del(key);
      } else {
        // preserve 7-day TTL matching session
        await redis.setex(
          key,
          7 * 24 * 60 * 60,
          JSON.stringify(validRedisItems),
        );
      }
    }

    return {
      items: enrichedItems,
      totalAmount,
    };
  }

  static async addItem(userId: string, productId: string, quantity: number) {
    const liveProduct = await prisma.product.findUnique({
      where: { id: productId, isActive: true },
    });

    if (!liveProduct) {
      throw new ApiError(404, "Product not found or inactive");
    }

    const key = this.getCartKey(userId);
    const cartData = await redis.get(key);
    let items: RedisCartItem[] = cartData ? JSON.parse(cartData) : [];

    const existingItemIndex = items.findIndex((i) => i.productId === productId);

    let newQuantity = quantity;
    if (existingItemIndex > -1) {
      newQuantity += items[existingItemIndex].quantity;
    }

    // Validate against current stock
    if (newQuantity > liveProduct.stock) {
      throw new ApiError(
        400,
        `Cannot add quantity. Only ${liveProduct.stock} items left in stock.`,
      );
    }

    if (existingItemIndex > -1) {
      items[existingItemIndex].quantity = newQuantity;
    } else {
      items.push({ productId, quantity: newQuantity });
    }

    // Save with 7-day expiration
    await redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(items));
    return this.getCart(userId); // Return live evaluated cart
  }

  static async updateItemQuantity(
    userId: string,
    productId: string,
    quantity: number,
  ) {
    const liveProduct = await prisma.product.findUnique({
      where: { id: productId, isActive: true },
    });

    if (!liveProduct) {
      throw new ApiError(404, "Product not found or inactive");
    }

    if (quantity > liveProduct.stock) {
      throw new ApiError(
        400,
        `Cannot update quantity. Only ${liveProduct.stock} items left in stock.`,
      );
    }

    const key = this.getCartKey(userId);
    const cartData = await redis.get(key);
    if (!cartData) {
      throw new ApiError(404, "Cart is empty");
    }

    let items: RedisCartItem[] = JSON.parse(cartData);
    const existingItemIndex = items.findIndex((i) => i.productId === productId);

    if (existingItemIndex === -1) {
      throw new ApiError(404, "Item not found in cart");
    }

    items[existingItemIndex].quantity = quantity;
    await redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(items));

    return this.getCart(userId);
  }

  static async removeItem(userId: string, productId: string) {
    const key = this.getCartKey(userId);
    const cartData = await redis.get(key);

    if (!cartData) return this.getCart(userId);

    let items: RedisCartItem[] = JSON.parse(cartData);
    items = items.filter((i) => i.productId !== productId);

    if (items.length === 0) {
      await redis.del(key);
    } else {
      await redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(items));
    }

    return this.getCart(userId);
  }

  static async clearCart(userId: string) {
    const key = this.getCartKey(userId);
    await redis.del(key);
  }
}

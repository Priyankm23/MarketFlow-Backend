import { Client } from "@elastic/elasticsearch";
import { env } from "./env.js";

export const elasticClient = new Client({
  node: env.ELASTIC_NODE,
  auth: {
    apiKey: env.ELASTIC_API_KEY,
  },
});

export const elasticProductsIndex = env.ELASTIC_PRODUCTS_INDEX;

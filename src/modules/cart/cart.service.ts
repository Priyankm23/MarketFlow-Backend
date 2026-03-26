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
   * Retrieves the cart from Redis (or DB if cache miss), 
   * enriches it with real-time DB prices & stock, 
   * and auto-corrects both Redis and DB if stock has changed.
   */
  static async getCart(userId: string) {
    const key = this.getCartKey(userId);
    let cartData = await redis.get(key);
    let items: RedisCartItem[] = [];

    if (cartData) {
      items = JSON.parse(cartData);
    } else {
      // Cache miss: Fallback to PostgreSQL
      const dbCart = await prisma.cart.findUnique({
        where: { userId },
        include: { items: true },
      });

      if (dbCart && dbCart.items.length > 0) {
        items = dbCart.items.map((i: any) => ({
          productId: i.productId,
          quantity: i.quantity,
        }));
        // Warm up cache
        await redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(items));
      }
    }

    if (items.length === 0) {
      return { items: [], totalAmount: 0 };
    }

    // Fetch live product data from DB
    const productIds = items.map((item) => item.productId);
    const liveProducts = (await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      include: {
        vendor: { select: { businessName: true } },
      },
    })) as any[];

    const productMap = new Map(liveProducts.map((p: any) => [p.id, p]));
    const enrichedItems: any[] = [];
    let totalAmount = 0;
    let cartModified = false; // Tracks if we need to auto-correct the cart

    const validRedisItems: RedisCartItem[] = [];

    for (const item of items) {
      const liveProduct = productMap.get(item.productId);

      // If product is deleted or inactive, remove from cart
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
        cartModified = true; // Mark as modified if stock fell to 0
      }
    }

    // If items were removed or adjusted due to stock/deletions, update Redis and PostgreSQL
    if (cartModified) {
      if (validRedisItems.length === 0) {
        await this.clearCart(userId);
      } else {
        // Update Redis
        await redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(validRedisItems));
        
        // Sync adjustments to DB
        const dbCart = await prisma.cart.findUnique({ where: { userId }});
        if (dbCart) {
          await prisma.$transaction(async (tx: any) => {
            // Clear existing db items
            await tx.cartItem.deleteMany({ where: { cartId: dbCart.id } });
            // Re-insert physically valid items (matching what Redis holds)
            await tx.cartItem.createMany({
              data: validRedisItems.map(item => ({
                cartId: dbCart.id,
                productId: item.productId,
                quantity: item.quantity
              }))
            });
          });
        }
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

    // Upsert DB Cart
    const cart = await prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const existingItem = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } }
    });

    const newQuantity = (existingItem?.quantity || 0) + quantity;

    // Validate against current stock
    if (newQuantity > liveProduct.stock) {
      throw new ApiError(
        400,
        `Cannot add quantity. Only ${liveProduct.stock} items left in stock.`,
      );
    }

    // Upsert DB CartItem
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      create: { cartId: cart.id, productId, quantity: newQuantity },
      update: { quantity: newQuantity }
    });

    // Invalidate Redis cache to force DB reload
    await redis.del(this.getCartKey(userId));
    return this.getCart(userId);
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

    const cart = await prisma.cart.findUnique({ where: { userId }});
    if (!cart) throw new ApiError(404, "Cart is empty");

    const existingItem = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } }
    });

    if (!existingItem) {
      throw new ApiError(404, "Item not found in cart");
    }

    // Update DB
    await prisma.cartItem.update({
      where: { cartId_productId: { cartId: cart.id, productId } },
      data: { quantity }
    });

    // Invalidate Redis cache to force DB reload
    await redis.del(this.getCartKey(userId));
    return this.getCart(userId);
  }

  static async removeItem(userId: string, productId: string) {
    const cart = await prisma.cart.findUnique({ where: { userId }});
    if (cart) {
      await prisma.cartItem.delete({
        where: { cartId_productId: { cartId: cart.id, productId } }
      }).catch(() => {}); // Catch if item didn't exist strictly
    }

    // Invalidate Redis cache
    await redis.del(this.getCartKey(userId));
    return this.getCart(userId);
  }

  static async clearCart(userId: string) {
    const cart = await prisma.cart.findUnique({ where: { userId }});
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }

    const key = this.getCartKey(userId);
    await redis.del(key);
  }
}

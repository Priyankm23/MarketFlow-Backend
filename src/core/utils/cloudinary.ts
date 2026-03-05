import { v2 as cloudinary } from "cloudinary";
import { env } from "../../config/env.js";

// Cloudinary configuration
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a file buffer to Cloudinary
 * @param fileBuffer The file buffer passed by Multer
 * @param folder The target folder in Cloudinary
 * @returns The secure URL of the uploaded image
 */
export const uploadToCloudinary = async (
  fileBuffer: Buffer,
  folder: string,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { 
        folder: folder,
        resource_type: "auto" // Crucial for PDFs and handling raw files properly
      },
      (error, result) => {
        if (error) return reject(error);
        if (result) return resolve(result.secure_url);
        reject(new Error("Unknown error uploading to Cloudinary"));
      },
    );
    uploadStream.end(fileBuffer);
  });
};

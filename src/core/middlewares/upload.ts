import multer from "multer";

// We use memory storage to keep the files as buffers in RAM
// so we can stream them directly to Cloudinary without saving to disk.
const storage = multer.memoryStorage();

// Accept standard image and PDF formats (useful for gov docs and registrations)
const fileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only JPEG, PNG, WEBP, and PDF are allowed.",
      ),
    );
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

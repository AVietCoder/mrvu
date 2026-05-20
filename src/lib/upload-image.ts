import cloudinary from "@/lib/cloudinary";

export async function uploadImage(file: string) {
  const result = await cloudinary.uploader.upload(file, {
    folder: "mrvu-products",
  });

  return result.secure_url;
}
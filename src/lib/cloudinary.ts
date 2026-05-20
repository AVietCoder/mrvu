function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const cloudName = requireEnv("VITE_CLOUDINARY_CLOUD_NAME", import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined);
const uploadPreset = requireEnv("VITE_CLOUDINARY_UPLOAD_PRESET", import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined);

export async function uploadImageToCloudinary(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error?.message || "Cloudinary upload failed");
  }

  return json.secure_url as string;
}

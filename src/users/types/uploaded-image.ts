// The in-memory file fields required by the profile photo workflow.
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;

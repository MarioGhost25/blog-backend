// Fields provided by Multer's in-memory storage and used by attachments.
export interface UploadedAttachment {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

import { UnsupportedMediaTypeException } from '@nestjs/common';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

/** Decode bytes; a MIME label/signature alone does not establish a valid file. */
export async function validateMediaFile(
  file: {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
  },
  type: 'image' | 'document',
) {
  try {
    const extension = file.originalname?.split('.').pop()?.toLowerCase();
    if (type === 'document') {
      if (
        file.mimetype !== 'application/pdf' ||
        (extension && extension !== 'pdf') ||
        file.buffer.subarray(0, 5).toString() !== '%PDF-'
      )
        throw new Error();
      const pdf = await PDFDocument.load(file.buffer, {
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      if (pdf.isEncrypted || pdf.getPageCount() < 1) throw new Error();
      return;
    }
    const expected =
      file.mimetype === 'image/png'
        ? 'png'
        : file.mimetype === 'image/jpeg'
          ? 'jpeg'
          : '';
    if (
      !expected ||
      (extension &&
        !(expected === 'png' ? ['png'] : ['jpg', 'jpeg']).includes(extension))
    )
      throw new Error();
    const decoder = sharp(file.buffer, {
      failOn: 'warning',
      limitInputPixels: 24_000_000,
    });
    const metadata = await decoder.metadata();
    if (metadata.format !== expected || (metadata.pages ?? 1) !== 1)
      throw new Error();
    await decoder.stats();
  } catch {
    throw new UnsupportedMediaTypeException(
      'Invalid, damaged or unsupported file',
    );
  }
}

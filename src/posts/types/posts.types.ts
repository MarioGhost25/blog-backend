export type PostStatus = 'visible' | 'retained' | 'deleted';
export type AttachmentType = 'image' | 'document' | 'link';
export interface PostWrite {
  authorId: bigint;
  categoryId: bigint;
  groupId?: bigint | null;
  title: string;
  content: string;
  status: Exclude<PostStatus, 'deleted'>;
}
export interface AttachmentWrite {
  postId: bigint;
  type: AttachmentType;
  title: string;
  url: string;
  cloudinaryPublicId?: string | null;
}

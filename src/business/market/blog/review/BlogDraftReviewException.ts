export class BlogDraftReviewException extends Error {
  constructor(message:string, readonly code="BLOG_DRAFT_REVIEW_FAILURE") { super(message); this.name="BlogDraftReviewException"; }
}

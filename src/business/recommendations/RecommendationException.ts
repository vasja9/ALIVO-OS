export class RecommendationException extends Error {
  constructor(message:string,readonly code:string="RECOMMENDATION_ERROR"){super(message);this.name="RecommendationException";}
}

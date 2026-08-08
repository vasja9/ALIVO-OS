export class ContinuousLearningException extends Error {
  constructor(message:string,readonly code:string="CONTINUOUS_LEARNING_ERROR"){super(message);this.name="ContinuousLearningException";}
}

export class UnresolvedVariablesError extends Error {
  readonly unresolved: string[];

  constructor(message: string, unresolved: string[]) {
    super(message);
    this.name = "UnresolvedVariablesError";
    this.unresolved = unresolved;
  }
}

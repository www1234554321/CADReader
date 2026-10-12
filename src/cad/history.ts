import { CADDocument, CADEntity } from './types';

export class HistoryManager {
  private undoStack: CADEntity[][] = [];
  private redoStack: CADEntity[][] = [];

  public pushState(doc: CADDocument) {
    // Deep clone entities array
    const snapshot: CADEntity[] = JSON.parse(JSON.stringify(doc.entities));
    this.undoStack.push(snapshot);
    this.redoStack = []; // Clear redo stack on new action
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(doc: CADDocument): boolean {
    if (!this.canUndo()) return false;
    const currentState: CADEntity[] = JSON.parse(JSON.stringify(doc.entities));
    this.redoStack.push(currentState);

    const previousState = this.undoStack.pop()!;
    doc.entities = previousState;
    return true;
  }

  public redo(doc: CADDocument): boolean {
    if (!this.canRedo()) return false;
    const currentState: CADEntity[] = JSON.parse(JSON.stringify(doc.entities));
    this.undoStack.push(currentState);

    const nextState = this.redoStack.pop()!;
    doc.entities = nextState;
    return true;
  }
}

import { createDragDropManager } from "dnd-core";
import { HTML5Backend } from "react-dnd-html5-backend";

// react-arborist's <Tree> mounts its own <DndProvider backend={HTML5Backend}>.
// react-dnd's default singleton context nulls out its manager reference on
// unmount without tearing down the HTML5 backend, so remounting the tree
// (e.g. on project switch) creates a second backend and throws
// "Cannot have two HTML5 backends at the same time." Passing a manager we
// own — created exactly once — makes <Tree> skip that singleton path entirely.
export const fileTreeDndManager = createDragDropManager(HTML5Backend);

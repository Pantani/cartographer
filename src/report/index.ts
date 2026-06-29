// report/ — pure rendering of a TraceResult to human text or JSON (architecture rule 2).
// Imports only from types/; never touches the network.
export { renderHuman } from "./human.js";
export { renderJson, BIGINT_TAG } from "./json.js";
export { render } from "./render.js";

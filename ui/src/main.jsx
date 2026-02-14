import "./index.css";
import { mountStyleGridPanel } from "./Panel";

if (typeof window !== "undefined") {
  window.StyleGridMount = mountStyleGridPanel;
}

import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./styles.css";
import "./enhancements.css";

createRoot(document.getElementById("root")!).render(<BrowserRouter><App/></BrowserRouter>);

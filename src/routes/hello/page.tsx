import type { PageHandler } from "../../framework";

const HelloPage: PageHandler = (_ctx) => (
  <>
    <h1>Hello from TSX!</h1>
    <p>This page is rendered using Rain.js JSX.</p>
  </>
);

export default HelloPage;

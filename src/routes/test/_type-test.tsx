import type { Handler } from "../../framework";

export const GET: Handler = (ctx) => {
  return ctx.html(
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <title>Hello TSX</title>
      </head>
      <body>
        <h1>Hello from TSX!</h1>
        <p>This page is rendered using Rain.js JSX.</p>
      </body>
    </html>,
  );
};

import type { LayoutHandler, RainElement } from "../framework";

const RootLayout: LayoutHandler = (_ctx, children: RainElement) => (
  <html lang="ja">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Rain.js App</title>
    </head>
    <body>{children}</body>
  </html>
);

export default RootLayout;

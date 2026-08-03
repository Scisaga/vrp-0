const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

const vendors = [
  {
    from: path.join(rootDir, "node_modules", "alpinejs-web-components", "dist", "esm.js"),
    to: path.join(rootDir, "assets", "vendor", "alpinejs-web-components", "0.1.3", "esm.js")
  },
  {
    from: path.join(rootDir, "node_modules", "alpinejs", "dist", "module.esm.js"),
    to: path.join(rootDir, "assets", "vendor", "alpinejs", "module.esm.js")
  },
  {
    from: path.join(rootDir, "node_modules", "codemirror", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "codemirror", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@codemirror", "view", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@codemirror", "view", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@codemirror", "state", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@codemirror", "state", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@codemirror", "language", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@codemirror", "language", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@codemirror", "lint", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@codemirror", "lint", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@codemirror", "search", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@codemirror", "search", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@codemirror", "autocomplete", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@codemirror", "autocomplete", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@codemirror", "commands", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@codemirror", "commands", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@codemirror", "lang-json", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@codemirror", "lang-json", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@lezer", "common", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@lezer", "common", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@lezer", "highlight", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@lezer", "highlight", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@lezer", "json", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@lezer", "json", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@lezer", "lr", "dist", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@lezer", "lr", "dist", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "@marijn", "find-cluster-break", "src", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "@marijn", "find-cluster-break", "src", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "crelt", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "crelt", "index.js")
  },
  {
    from: path.join(rootDir, "node_modules", "style-mod", "src", "style-mod.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "style-mod", "src", "style-mod.js")
  },
  {
    from: path.join(rootDir, "node_modules", "w3c-keyname", "index.js"),
    to: path.join(rootDir, "assets", "vendor", "codemirror", "w3c-keyname", "index.js")
  }
];

for (const vendor of vendors) {
  if (!fs.existsSync(vendor.from)) {
    throw new Error(`Missing vendor source: ${path.relative(rootDir, vendor.from)}`);
  }

  fs.mkdirSync(path.dirname(vendor.to), { recursive: true });
  fs.copyFileSync(vendor.from, vendor.to);
  console.log(`[sync-vendor] wrote ${path.relative(rootDir, vendor.to)}`);
}

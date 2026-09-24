import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist/", "node_modules/", "examples/"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		rules: {
			// Paket sınırlarında (config, sürücüler, generated client) bilinçli olarak `any` kullanılıyor.
			"@typescript-eslint/no-explicit-any": "off",
			// `UtilitiesConfig`, `RegisteredPrismaClient` boş interface'leri declaration merging için var.
			"@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "always" }],
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		},
	},
	{
		files: ["test/**/*.{js,mjs,cjs}", "*.mjs"],
		languageOptions: { globals: { ...globals.node } },
		rules: {
			"@typescript-eslint/no-require-imports": "off",
		},
	},
);

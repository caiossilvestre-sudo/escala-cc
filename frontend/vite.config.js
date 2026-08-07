import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// "base" precisa bater com o nome do repositório no GitHub Pages
// (https://SEU-USUARIO.github.io/NOME-DO-REPO/). Se o nome do seu repo for
// diferente de "escala-cc", troque aqui.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES ? "/escala-cc/" : "/",
  server: { port: 5173 },
});

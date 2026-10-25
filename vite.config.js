import { defineConfig, loadEnv } from "vite";

export default defineConfig(() => {
  const serverEnv = loadEnv("development", "server", "PORT");
  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const pagesBase =
    process.env.GITHUB_ACTIONS === "true" && repositoryName
      ? repositoryName.toLowerCase().endsWith(".github.io")
        ? "/"
        : `/${repositoryName}/`
      : "/";
  return {
    base: pagesBase,
    server: {
      host: "127.0.0.1",
      proxy: {
        "/api": `http://127.0.0.1:${process.env.PORT || serverEnv.PORT || 3001}`,
      },
    },
    preview: {
      host: "127.0.0.1",
      proxy: {
        "/api": `http://127.0.0.1:${process.env.PORT || serverEnv.PORT || 3001}`,
      },
    },
  };
});

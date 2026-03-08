import path from "path";
import { createVanillaExtractPlugin } from "@vanilla-extract/next-plugin";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@leflect-java/dashboard-data"],
  typedRoutes: false,
  outputFileTracingRoot: path.resolve(process.cwd(), "../..")
};

export default createVanillaExtractPlugin()(nextConfig);

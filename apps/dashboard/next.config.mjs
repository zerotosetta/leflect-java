import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@leflect-java/dashboard-data"],
  typedRoutes: false,
  outputFileTracingRoot: path.resolve(process.cwd(), "../..")
};

export default nextConfig;

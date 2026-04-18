/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // typedRoutes включим позже, когда стабилизируется карта роутов.
  // Сейчас некоторые Link ведут на ещё не созданные страницы (ROADMAP,
  // /docs/*) и typedRoutes ломал бы `next build` в Docker.
};

export default nextConfig;

/** The client bundler loads owned styles as text for effect-scoped installation. */
declare module '*.css' { const text: string; export default text }

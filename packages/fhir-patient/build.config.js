// override build config with an extra entry point
export default path => ({
  external: [],
  entry: [`${path}/src/index.ts`],
});

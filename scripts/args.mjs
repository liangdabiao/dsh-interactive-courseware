// scripts 公共小工具：读 --name value 参数
export const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : fallback
}

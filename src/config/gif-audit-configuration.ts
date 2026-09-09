/** 只读工具只需要 DB/S3；不依赖 tsx 不提供的装饰器类型元数据或应用其他配置。 */
export function gifAuditConfiguration(environment: Record<string, string | undefined>) {
  const required = (name: string) => {
    const value = environment[name];
    if (!value?.trim()) throw new Error('GIF_AUDIT_CONFIG_INVALID');
    return value;
  };
  const databaseUrl = required('DATABASE_URL');
  const endpoint = required('COS_ENDPOINT');
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
    throw new Error('GIF_AUDIT_CONFIG_INVALID');
  }
  if (!['http:', 'https:'].includes(new URL(endpoint).protocol)) {
    throw new Error('GIF_AUDIT_CONFIG_INVALID');
  }
  return {
    database: { url: databaseUrl },
    cos: {
      endpoint,
      region: environment.COS_REGION?.trim() || 'ap-hongkong',
      bucket: required('COS_BUCKET'),
      accessKeyId: required('COS_ACCESS_KEY_ID'),
      secretAccessKey: required('COS_SECRET_ACCESS_KEY'),
    },
  };
}

import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/** CUID 格式：cms... 等 Prisma cuid() 生成，25 字符 base36（小写字母+数字） */
export const CUID_REGEX = /^[a-z0-9]{24,26}$/;

@ValidatorConstraint({ name: 'IsCuid', async: false })
export class IsCuidConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && CUID_REGEX.test(value);
  }

  defaultMessage(): string {
    return '$property must be a CUID';
  }
}

/** 校验值是否为 CUID（Prisma cuid() 生成，替代不适用的 @IsUUID） */
export function IsCuid(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsCuidConstraint,
    });
  };
}

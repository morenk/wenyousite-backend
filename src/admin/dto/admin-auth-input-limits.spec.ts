import 'reflect-metadata';
import { validate, ValidationError } from 'class-validator';
import { AdminLoginChallengeDto } from './admin-auth.dto';

function findError(errors: ValidationError[], property: string) {
  return errors.find((error) => error.property === property);
}

describe('管理员认证输入长度边界', () => {
  it('限制管理员登录账号及密码长度', async () => {
    const errors = await validate(Object.assign(new AdminLoginChallengeDto(), {
      account: 'a'.repeat(255),
      password: 'A1'.repeat(51),
    }));

    expect(findError(errors, 'account')?.constraints).toHaveProperty('maxLength');
    expect(findError(errors, 'password')?.constraints).toHaveProperty('maxLength');
  });
});

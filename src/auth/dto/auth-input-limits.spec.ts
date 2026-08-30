import 'reflect-metadata';
import { validate, ValidationError } from 'class-validator';
import { ChangeEmailRequestDto } from './change-email.dto';
import { LoginDto } from './login.dto';
import { RefreshDto } from './refresh.dto';

function findError(errors: ValidationError[], property: string) {
  return errors.find((error) => error.property === property);
}

describe('认证输入长度边界', () => {
  it('限制普通登录账号及密码长度', async () => {
    const loginErrors = await validate(Object.assign(new LoginDto(), {
      account: 'a'.repeat(255),
      password: 'A1'.repeat(51),
    }));

    expect(findError(loginErrors, 'account')?.constraints).toHaveProperty('maxLength');
    expect(findError(loginErrors, 'password')?.constraints).toHaveProperty('maxLength');
  });

  it('限制 refresh token 和邮箱变更二次认证密码长度', async () => {
    const refreshErrors = await validate(Object.assign(new RefreshDto(), {
      refreshToken: 'x'.repeat(129),
    }));
    const emailErrors = await validate(Object.assign(new ChangeEmailRequestDto(), {
      newEmail: 'new@example.com',
      oldPassword: 'x'.repeat(101),
    }));

    expect(findError(refreshErrors, 'refreshToken')?.constraints).toHaveProperty('maxLength');
    expect(findError(emailErrors, 'oldPassword')?.constraints).toHaveProperty('maxLength');
  });
});

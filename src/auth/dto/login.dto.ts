import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  correo!: string;

  @IsString()
  @MaxLength(72)
  contrasena!: string;
}

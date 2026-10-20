import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegistroDto {
  @IsString()
  @Length(2, 80)
  nombre!: string;

  @IsString()
  @Length(2, 80)
  apellido!: string;

  @IsEmail()
  @MaxLength(254)
  correo!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/\p{Lu}/u, { message: 'La contraseña debe incluir una mayúscula' })
  @Matches(/[0-9]/, { message: 'La contraseña debe incluir un número' })
  @Matches(/[^\p{L}\p{N}\s]/u, {
    message: 'La contraseña debe incluir un símbolo',
  })
  contrasena!: string;
}

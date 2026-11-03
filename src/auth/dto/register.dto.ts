import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(2, 80)
  firstName!: string;

  @IsString()
  @Length(2, 80)
  lastName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/\p{Lu}/u, { message: 'Password must include an uppercase letter' })
  @Matches(/[0-9]/, { message: 'Password must include a number' })
  @Matches(/[^\p{L}\p{N}\s]/u, {
    message: 'Password must include a symbol',
  })
  password!: string;
}

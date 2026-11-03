import { IsString, Length, Matches, MaxLength, MinLength } from "class-validator";


export class ResetPasswordDto {

    @IsString()
    @Length(43, 43)
    token!: string

    @IsString()
    @MinLength(8)
    @MaxLength(72)
    @Matches(/\p{Lu}/u, { message: 'Password must include an uppercase letter' })
    @Matches(/[0-9]/, { message: 'Password must include a number' })
    @Matches(/[^\p{L}\p{N}\s]/u, {
        message: 'Password must include a symbol',
    })
    newPassword!: string

}
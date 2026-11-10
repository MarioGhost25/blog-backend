import { createApiValidationPipe } from './api-validation.pipe';
import { RegisterDto } from '../../auth/dto/register.dto';
import { CreateGroupDto } from '../../groups/dto/create-group.dto';
import { MemberFiltersDto } from '../../groups/dto/filter-groups.dto';
import { FilterPostsDto } from '../../posts/dto/filter-posts.dto';

const pipe = createApiValidationPipe();
const account = {
  firstName: 'Ana',
  lastName: 'Pruebas',
  email: 'synthetic@example.test',
  password: 'Synthetic-test-42!',
};
describe('normalization at the Nest validation boundary', () => {
  it('normalizes Unicode and plain names before length validation without changing credentials', async () => {
    const result = (await pipe.transform(
      {
        ...account,
        firstName: '  <b>Jose\u0301</b>  ',
        lastName: '\tDe\n la  Cruz ',
      },
      { type: 'body', metatype: RegisterDto },
    )) as RegisterDto;
    expect(result.firstName).toBe('José');
    expect(result.lastName).toBe('De la Cruz');
    expect(result.password).toBe(account.password);
    expect(result.email).toBe(account.email);
    const group = (await pipe.transform(
      { name: '  <b>研究組</b>  ', categoryId: '9223372036854775807' },
      { type: 'body', metatype: CreateGroupDto },
    )) as CreateGroupDto;
    expect(group.name).toBe('研究組');
    expect(group.categoryId).toBe('9223372036854775807');
  });
  it.each([
    ' \n\t\u00a0 ',
    '<script>ignored()</script>',
    'x'.repeat(81),
    null,
    42,
    {},
  ])(
    'rejects invalid account names before persistence: %p',
    async (firstName) => {
      await expect(
        pipe.transform(
          { ...account, firstName },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow();
    },
  );
  it('rejects blank/oversized groups and search arrays/oversized terms', async () => {
    for (const name of ['  \n  ', 'x'.repeat(101)]) {
      await expect(
        pipe.transform(
          { name, categoryId: 1 },
          { type: 'body', metatype: CreateGroupDto },
        ),
      ).rejects.toThrow();
    }
    for (const metatype of [MemberFiltersDto, FilterPostsDto]) {
      for (const q of ['x'.repeat(255), ['one', 'two']])
        await expect(
          pipe.transform({ q }, { type: 'query', metatype }),
        ).rejects.toThrow();
      const value = (await pipe.transform(
        { q: '  Jose\u0301  ' },
        { type: 'query', metatype },
      )) as MemberFiltersDto;
      expect(value.q).toBe('José');
    }
    await expect(
      pipe.transform({ q: ' a ' }, { type: 'query', metatype: FilterPostsDto }),
    ).rejects.toThrow();
  });
});

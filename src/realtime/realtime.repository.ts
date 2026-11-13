import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class RealtimeRepository {
  constructor(private readonly prisma: PrismaService) {}
  removePresence(args: Prisma.PresenciaSalaDeleteManyArgs) {
    return this.prisma.presenciaSala.deleteMany(args);
  }
  refreshPresence(args: Prisma.PresenciaSalaUpdateManyArgs) {
    return this.prisma.presenciaSala.updateMany(args);
  }
  joinPresence(args: Prisma.PresenciaSalaUpsertArgs) {
    return this.prisma.presenciaSala.upsert(args);
  }
  findPresence(args: Prisma.PresenciaSalaFindManyArgs) {
    return this.prisma.presenciaSala.findMany(args);
  }
  countGroups(args: Prisma.GrupoEstudioCountArgs) {
    return this.prisma.grupoEstudio.count(args);
  }
}

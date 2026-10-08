import { Body, Controller, Get, Post } from '@nestjs/common';

import { UsersService, type User } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): User[] {
    return this.users.list();
  }

  @Post()
  create(@Body() body: { name: string }): User {
    return this.users.create(body.name);
  }
}

import { Injectable } from '@nestjs/common';

export interface User {
  id: number;
  name: string;
}

@Injectable()
export class UsersService {
  private readonly users: User[] = [
    { id: 1, name: 'Ada Lovelace' },
    { id: 2, name: 'Alan Turing' },
  ];

  list(): User[] {
    return this.users;
  }

  create(name: string): User {
    const user = { id: this.users.length + 1, name };
    this.users.push(user);
    return user;
  }
}

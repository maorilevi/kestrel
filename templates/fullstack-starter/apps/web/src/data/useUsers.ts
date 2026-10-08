import { useCallback, useEffect, useState } from 'react';

import { api } from './api';

export interface User {
  id: number;
  name: string;
}

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    void api.get<User[]>('/api/users').then(setUsers);
  }, []);

  const addUser = useCallback(async (name: string) => {
    const user = await api.post<User>('/api/users', { name });
    setUsers((current) => [...current, user]);
  }, []);

  return { users, addUser };
}

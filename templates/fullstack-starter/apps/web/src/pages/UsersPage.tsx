import { useState } from 'react';

import { useUsers } from '../data/useUsers';

export function UsersPage() {
  const { users, addUser } = useUsers();
  const [name, setName] = useState('');

  return (
    <section>
      <h2>Users</h2>
      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) {
            void addUser(name.trim());
            setName('');
          }
        }}
      >
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <button type="submit">Add</button>
      </form>
    </section>
  );
}

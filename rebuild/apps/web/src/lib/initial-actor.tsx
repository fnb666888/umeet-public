'use client';
import { createContext, useContext } from 'react';
import type { Snapshot } from '../components/community/model';
export type InitialActor = Snapshot['actor'];
export const InitialActorContext = createContext<InitialActor>(null);
export const useInitialActor = () => useContext(InitialActorContext);

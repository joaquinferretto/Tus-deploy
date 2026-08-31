function createJSONStorage(getStorage) {
  let storage
  try {
    storage = getStorage()
  } catch {
    return undefined
  }
  if (storage === undefined) return undefined

  return {
    getItem: async (name) => {
      const value = await storage.getItem(name)
      return value === null ? null : JSON.parse(value)
    },
    setItem: (name, value) => storage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => storage.removeItem(name),
  }
}

function persist(config, initialOptions) {
  return (set, get, api) => {
    let options = {
      ...initialOptions,
      version: initialOptions.version ?? 0,
      partialize: initialOptions.partialize ?? ((state) => state),
      merge: initialOptions.merge ?? ((persistedState, currentState) => ({ ...currentState, ...persistedState })),
    }
    let hydrated = false

    const setItem = () => {
      if (options.storage === undefined) return undefined
      return options.storage.setItem(options.name, {
        state: options.partialize(get()),
        version: options.version,
      })
    }

    const wrappedSet = (...args) => {
      set(...args)
      void setItem()
    }
    const state = config(wrappedSet, get, api)
    const savedSetState = api.setState
    api.setState = (...args) => {
      savedSetState(...args)
      void setItem()
    }

    const rehydrate = async () => {
      const afterHydration = options.onRehydrateStorage?.(get())
      try {
        const persisted = await options.storage?.getItem(options.name)
        if (persisted !== null && persisted !== undefined) {
          const nextState = persisted.version === options.version
            ? persisted.state
            : options.migrate === undefined
              ? undefined
              : await options.migrate(persisted.state, persisted.version ?? 0)
          if (nextState !== undefined) set(options.merge(nextState, get()), true)
        }
        hydrated = true
        afterHydration?.(get())
      } catch (error) {
        afterHydration?.(undefined, error)
        throw error
      }
    }

    api.persist = {
      setOptions: (nextOptions) => { options = { ...options, ...nextOptions } },
      clearStorage: () => options.storage?.removeItem(options.name),
      rehydrate,
      hasHydrated: () => hydrated,
      onHydrate: () => () => undefined,
      onFinishHydration: () => () => undefined,
      getOptions: () => options,
    }

    if (initialOptions.skipHydration !== true) void rehydrate()
    return state
  }
}

module.exports = { createJSONStorage, persist }

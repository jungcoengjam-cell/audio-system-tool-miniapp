const SAFE_IDENTIFICATION_METHODS = new Set(['visible-label', 'qualified-photo', 'maintainer-document'])

function list(value) {
  return Array.isArray(value) ? value : []
}

function findUniqueById(items, id) {
  if (!hasText(id)) return null
  const matches = list(items).filter((item) => item && item.id === id)
  return matches.length === 1 ? matches[0] : null
}

function isVerifiedSource(catalog, sourceId) {
  const source = findUniqueById(catalog.sources, sourceId)
  return Boolean(source
    && source.status === 'verified'
    && source.reviewerId
    && source.authorizationConfirmed === true)
}

function getApprovedPhotos(catalog, ownerType, ownerId) {
  return list(catalog.photos).filter((photo) => (
    photo
    && photo.ownerType === ownerType
    && photo.ownerId === ownerId
    && photo.status === 'ready'
    && photo.authorizationConfirmed === true
    && photo.redactionReviewed === true
    && photo.path
    && isVerifiedSource(catalog, photo.sourceId)
  ))
}

// Development samples may be shown as non-authorized reference material, but
// these photos never participate in protocol admission or identity resolution.
function getDevelopmentDraftPhotos(catalog, ownerType, ownerId) {
  if (catalog.developmentDraftOnly !== true) return []
  return list(catalog.photos).filter((photo) => (
    photo
    && photo.developmentOnly === true
    && photo.status === 'draft'
    && photo.ownerType === ownerType
    && photo.ownerId === ownerId
    && photo.authorizationConfirmed !== true
    && photo.redactionReviewed !== true
    && photo.path
  ))
}

function getDevelopmentDraftPhotosForAppearanceGroup(catalog, appearanceGroupId) {
  if (catalog.developmentDraftOnly !== true) return []
  const group = findUniqueById(catalog.appearanceGroups, appearanceGroupId)
  if (!group) return []
  const deviceCandidates = list(catalog.deviceVariants)
    .filter((device) => device && device.appearanceGroupId === group.id)
  if (deviceCandidates.length !== 1) return []
  const device = findUniqueById(catalog.deviceVariants, deviceCandidates[0].id)
  if (!device || device.appearanceGroupId !== group.id) return []

  const controllerCandidates = list(catalog.controllerVariants)
    .filter((controller) => controller && controller.deviceVariantId === device.id)
  if (controllerCandidates.length !== 1) return []
  const controller = findUniqueById(catalog.controllerVariants, controllerCandidates[0].id)
  if (!controller || controller.deviceVariantId !== device.id) return []
  return getDevelopmentDraftPhotos(catalog, 'controllerVariant', controller.id)
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase()
}

function searchGallery(catalog, filters = {}) {
  const category = filters.category || 'all'
  const keyword = normalizeSearch(filters.keyword)
  return list(catalog.appearanceGroups)
    .filter((group) => group && (category === 'all' || group.categoryKey === category))
    .map((group) => {
      const deviceVariants = list(catalog.deviceVariants)
        .filter((variant) => variant && variant.appearanceGroupId === group.id)
      const photo = catalog.developmentDraftOnly === true
        ? getDevelopmentDraftPhotosForAppearanceGroup(catalog, group.id)[0] || null
        : getApprovedPhotos(catalog, 'appearanceGroup', group.id)[0] || null
      const resolution = resolveAppearanceGroupProtocol(catalog, group.id)
      const entryLabel = catalog.developmentDraftOnly === true && group.developmentManual
        ? '查看协议'
        : resolution.allowed
        ? '查看协议'
        : (/ambiguous/.test(resolution.reason) ? '无法自动匹配' : '协议待核验')
      return { groupId: group.id, group, deviceVariants, photo, entryLabel }
    })
    .filter(({ group, deviceVariants }) => {
      if (!keyword) return true
      const searchFields = [group.title, group.categoryLabel, ...list(group.aliases)]
      deviceVariants.forEach((variant) => {
        searchFields.push(variant.brand, variant.model, variant.version, ...list(variant.aliases))
      })
      return searchFields.some((field) => normalizeSearch(field).includes(keyword))
    })
}

function isValidReferenceManual(reference) {
  return Boolean(reference
    && hasText(reference.id)
    && /^reference-[a-z0-9-]+$/.test(reference.id)
    && hasText(reference.title)
    && hasText(reference.categoryKey)
    && hasText(reference.controllerModel)
    && hasText(reference.sourceTitle)
    && hasText(reference.documentVersion)
    && /^[0-9A-F]{64}$/.test(reference.sourceSha256 || '')
    && hasText(reference.publicUseBasis)
    && reference.photo
    && hasText(reference.photo.path)
    && /^[0-9A-F]{64}$/.test(reference.photo.sha256 || '')
    && reference.photo.publicUseBasis === reference.publicUseBasis
    && reference.manual
    && Array.isArray(reference.manual.transports)
    && reference.manual.transports.length > 0)
}

function searchReferenceManuals(catalog, filters = {}) {
  const category = filters.category || 'all'
  const keyword = normalizeSearch(filters.keyword)
  return list(catalog.referenceManuals)
    .filter((reference) => getReferenceManualDetail(catalog, reference && reference.id) === reference
      && (category === 'all' || reference.categoryKey === category))
    .filter((reference) => {
      if (!keyword) return true
      return [reference.title, reference.categoryLabel, reference.controllerBrand,
        reference.controllerModel, reference.deviceModel, ...list(reference.aliases)]
        .some((field) => normalizeSearch(field).includes(keyword))
    })
    .map((reference) => ({
      referenceId: reference.id,
      title: reference.title,
      photo: reference.photo && reference.photo.path
        ? { path: reference.photo.path }
        : null,
    }))
}

function getReferenceManualDetail(catalog, referenceId) {
  const reference = findUniqueById(catalog.referenceManuals, referenceId)
  return isValidReferenceManual(reference) ? reference : null
}

function getAppearanceGroupDetail(catalog, appearanceGroupId) {
  const group = findUniqueById(catalog.appearanceGroups, appearanceGroupId)
  if (!group) return null
  const photos = getApprovedPhotos(catalog, 'appearanceGroup', group.id)
  return {
    group,
    photo: photos[0] || null,
    photos,
    deviceVariants: list(catalog.deviceVariants).filter((variant) => (
      variant && variant.appearanceGroupId === group.id
    )),
  }
}

function sameIdentityValue(actual, selected) {
  return typeof actual === 'string' && actual.trim().length > 0 && actual === selected
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isCompleteProtocol(protocol, source) {
  return hasText(protocol.protocolVersion)
    && hasText(protocol.title)
    && hasText(protocol.transportSummary)
    && hasText(protocol.copyText)
    && hasText(protocol.updatedAt)
    && hasText(protocol.sourceTitle || (source && source.title))
    && hasText(protocol.reviewerName || (source && source.reviewerName))
    && Array.isArray(protocol.commands)
    && protocol.commands.length > 0
    && protocol.commands.every((command) => (
      command && hasText(command.id) && hasText(command.label) && hasText(command.value)
    ))
}

function resolveAppearanceGroupProtocol(catalog, appearanceGroupId) {
  const detail = getAppearanceGroupDetail(catalog, appearanceGroupId)
  if (!detail) return { allowed: false, reason: 'unknown-appearance-group' }
  const context = { group: detail.group, photos: detail.photos }
  const block = (reason, extra = {}) => ({ allowed: false, reason, ...context, ...extra })
  if (detail.group.directMappingReviewed !== true || !hasText(detail.group.mappingReviewerId)) {
    return block('appearance-mapping-unreviewed')
  }
  if (!detail.photos.length) return block('appearance-photo-missing')

  const deviceVariants = detail.deviceVariants
  if (!deviceVariants.length) return block('device-variant-missing')
  if (deviceVariants.length !== 1) return block('device-variant-ambiguous')
  const deviceVariant = findUniqueById(catalog.deviceVariants, deviceVariants[0].id)
  if (!deviceVariant || deviceVariant.appearanceGroupId !== detail.group.id
    || !['brand', 'model', 'version'].every((field) => hasText(deviceVariant[field]))) {
    return block('device-identity-incomplete')
  }
  const devicePhotos = getApprovedPhotos(catalog, 'deviceVariant', deviceVariant.id)
  const deviceContext = { deviceVariant, photos: [...detail.photos, ...devicePhotos] }

  const controllerCandidates = list(catalog.controllerVariants)
    .filter((variant) => variant && variant.deviceVariantId === deviceVariant.id)
  if (!controllerCandidates.length) return block('controller-variant-missing', deviceContext)
  if (controllerCandidates.length !== 1) return block('controller-variant-ambiguous', deviceContext)
  const controllerVariant = findUniqueById(catalog.controllerVariants, controllerCandidates[0].id)
  if (!controllerVariant || controllerVariant.deviceVariantId !== deviceVariant.id
    || !['brand', 'model', 'version'].every((field) => hasText(controllerVariant[field]))) {
    return block('controller-identity-incomplete', deviceContext)
  }
  const controllerPhotos = getApprovedPhotos(catalog, 'controllerVariant', controllerVariant.id)
  const controllerContext = {
    ...deviceContext,
    controllerVariant,
    photos: [...deviceContext.photos, ...controllerPhotos],
  }
  if (controllerVariant.status !== 'verified') {
    return block('controller-source-unverified', controllerContext)
  }

  const identificationSource = findUniqueById(catalog.sources, controllerVariant.identificationSourceId)
  if (!SAFE_IDENTIFICATION_METHODS.has(controllerVariant.identificationMethod)
    || !isVerifiedSource(catalog, controllerVariant.identificationSourceId)
    || identificationSource.reviewerId !== controllerVariant.reviewerId) {
    return block('controller-source-unverified', controllerContext)
  }

  const matchingProtocols = list(catalog.protocols).filter((item) => (
    item && item.controllerVariantId === controllerVariant.id
  ))
  if (!matchingProtocols.length) return block('protocol-not-found', controllerContext)
  if (matchingProtocols.length !== 1) return block('protocol-ambiguous', controllerContext)
  if (!hasText(matchingProtocols[0].id)) return block('protocol-incomplete', controllerContext)
  const protocol = findUniqueById(catalog.protocols, matchingProtocols[0].id)
  if (!protocol || !sameIdentityValue(protocol.controllerBrand, controllerVariant.brand)
    || !sameIdentityValue(protocol.controllerModel, controllerVariant.model)) {
    return block('protocol-identity-mismatch', controllerContext)
  }
  if (!sameIdentityValue(protocol.controllerVersion, controllerVariant.version)) {
    return block('protocol-version-mismatch', controllerContext)
  }
  if (protocol.status !== 'verified' || !protocol.reviewerId) {
    return block('protocol-not-verified', controllerContext)
  }
  const protocolSource = findUniqueById(catalog.sources, protocol.sourceId)
  if (!isVerifiedSource(catalog, protocol.sourceId)
    || protocolSource.reviewerId !== protocol.reviewerId) {
    return block('protocol-source-unverified', controllerContext)
  }
  if (!isCompleteProtocol(protocol, protocolSource)) {
    return block('protocol-incomplete', controllerContext)
  }
  return {
    allowed: true,
    reason: 'verified-match',
    ...controllerContext,
    protocol: {
      ...protocol,
      displaySourceTitle: protocol.sourceTitle || protocolSource.title || '',
      displayReviewerName: protocol.reviewerName || protocolSource.reviewerName || '',
    },
  }
}

module.exports = {
  searchGallery,
  searchReferenceManuals,
  getReferenceManualDetail,
  getAppearanceGroupDetail,
  getDevelopmentDraftPhotos,
  getDevelopmentDraftPhotosForAppearanceGroup,
  resolveAppearanceGroupProtocol,
}

import { analysisTrackKeywords } from './analysis.track-keywords'
import { z } from 'zod'

import {
    TRACKS_AGRICULTURE_AND_RURAL_LIFE,
    TRACKS_AI_AND_PRODUCTIVITY,
    TRACKS_AUTOMOTIVE_AND_MOBILITY,
    TRACKS_BEAUTY_SKINCARE,
    TRACKS_BUSINESS_AND_ENTREPRENEURSHIP,
    TRACKS_CAREER_AND_EMPLOYMENT,
    TRACKS_CONSUMER_TECHNOLOGY,
    TRACKS_CULTURE_AND_HUMANITIES,
    TRACKS_EDUCATION,
    TRACKS_FASHION,
    TRACKS_FILM_AND_ENTERTAINMENT,
    TRACKS_FINANCE_AND_INVESTING,
    TRACKS_FOOD_AND_DRINK,
    TRACKS_GAMING_AND_ANIME,
    TRACKS_HEALTH_AND_WELLNESS,
    TRACKS_HOBBIES_AND_LIFESTYLE,
    TRACKS_HOME_AND_RENOVATION,
    TRACKS_LAW_AND_SOCIETY,
    TRACKS_LOCAL_LIFE,
    TRACKS_MARRIAGE_AND_FAMILY,
    TRACKS_OTHER,
    TRACKS_OUTDOORS,
    TRACKS_PARENTING,
    TRACKS_PERSONAL_GROWTH,
    TRACKS_PETS,
    TRACKS_PHOTOGRAPHY_AND_DESIGN,
    TRACKS_REAL_ESTATE,
    TRACKS_RELATIONSHIPS_AND_PSYCHOLOGY,
    TRACKS_SCIENCE_EDUCATION,
    TRACKS_SPORTS_AND_FITNESS,
    TRACKS_TRAVEL,
} from '../../config/constants'

/** 稳定赛道标识；顺序不是展示顺序，展示顺序由目录数组固定。 */
export const analysisTrackIds = [
    'beauty_skincare',
    'fashion',
    'food_and_drink',
    'travel',
    'health_and_wellness',
    'home_and_renovation',
    'sports_and_fitness',
    'parenting',
    'local_life',
    'pets',
    'ai_and_productivity',
    'outdoors',
    'relationships_and_psychology',
    'hobbies_and_lifestyle',
    'education',
    'personal_growth',
    'career_and_employment',
    'photography_and_design',
    'consumer_technology',
    'marriage_and_family',
    'gaming_and_anime',
    'film_and_entertainment',
    'business_and_entrepreneurship',
    'automotive_and_mobility',
    'culture_and_humanities',
    'real_estate',
    'finance_and_investing',
    'science_education',
    'law_and_society',
    'agriculture_and_rural_life',
    'custom',
] as const

export const analysisTrackIdSchema = z.enum(analysisTrackIds)
export type AnalysisTrackId = z.infer<typeof analysisTrackIdSchema>

export interface AnalysisTrackDefinition {
    id: AnalysisTrackId
    code: number
    order: number
    labelKey: string
    keywords: readonly string[]
    custom: boolean
}

/**
 * 后端唯一赛道目录。关键词来自项目负责人确认的 v0.8.0 映射；前端只消费该目录。
 */
export const analysisTrackCatalog = [
    {
        id: 'beauty_skincare',
        code: TRACKS_BEAUTY_SKINCARE,
        order: 1,
        labelKey: 'workspace.configOptions.track.beautySkincare',
        keywords: analysisTrackKeywords.beauty_skincare,
        custom: false,
    },
    {
        id: 'fashion',
        code: TRACKS_FASHION,
        order: 2,
        labelKey: 'workspace.configOptions.track.fashion',
        keywords: analysisTrackKeywords.fashion,
        custom: false,
    },
    {
        id: 'food_and_drink',
        code: TRACKS_FOOD_AND_DRINK,
        order: 3,
        labelKey: 'workspace.configOptions.track.foodAndDrink',
        keywords: analysisTrackKeywords.food_and_drink,
        custom: false,
    },
    {
        id: 'travel',
        code: TRACKS_TRAVEL,
        order: 4,
        labelKey: 'workspace.configOptions.track.travel',
        keywords: analysisTrackKeywords.travel,
        custom: false,
    },
    {
        id: 'health_and_wellness',
        code: TRACKS_HEALTH_AND_WELLNESS,
        order: 5,
        labelKey: 'workspace.configOptions.track.healthAndWellness',
        keywords: analysisTrackKeywords.health_and_wellness,
        custom: false,
    },
    {
        id: 'home_and_renovation',
        code: TRACKS_HOME_AND_RENOVATION,
        order: 6,
        labelKey: 'workspace.configOptions.track.homeAndRenovation',
        keywords: analysisTrackKeywords.home_and_renovation,
        custom: false,
    },
    {
        id: 'sports_and_fitness',
        code: TRACKS_SPORTS_AND_FITNESS,
        order: 7,
        labelKey: 'workspace.configOptions.track.sportsAndFitness',
        keywords: analysisTrackKeywords.sports_and_fitness,
        custom: false,
    },
    {
        id: 'parenting',
        code: TRACKS_PARENTING,
        order: 8,
        labelKey: 'workspace.configOptions.track.parenting',
        keywords: analysisTrackKeywords.parenting,
        custom: false,
    },
    {
        id: 'local_life',
        code: TRACKS_LOCAL_LIFE,
        order: 9,
        labelKey: 'workspace.configOptions.track.localLife',
        keywords: analysisTrackKeywords.local_life,
        custom: false,
    },
    {
        id: 'pets',
        code: TRACKS_PETS,
        order: 10,
        labelKey: 'workspace.configOptions.track.pets',
        keywords: analysisTrackKeywords.pets,
        custom: false,
    },
    {
        id: 'ai_and_productivity',
        code: TRACKS_AI_AND_PRODUCTIVITY,
        order: 11,
        labelKey: 'workspace.configOptions.track.aiAndProductivity',
        keywords: analysisTrackKeywords.ai_and_productivity,
        custom: false,
    },
    {
        id: 'outdoors',
        code: TRACKS_OUTDOORS,
        order: 12,
        labelKey: 'workspace.configOptions.track.outdoors',
        keywords: analysisTrackKeywords.outdoors,
        custom: false,
    },
    {
        id: 'relationships_and_psychology',
        code: TRACKS_RELATIONSHIPS_AND_PSYCHOLOGY,
        order: 13,
        labelKey: 'workspace.configOptions.track.relationshipsAndPsychology',
        keywords: analysisTrackKeywords.relationships_and_psychology,
        custom: false,
    },
    {
        id: 'hobbies_and_lifestyle',
        code: TRACKS_HOBBIES_AND_LIFESTYLE,
        order: 14,
        labelKey: 'workspace.configOptions.track.hobbiesAndLifestyle',
        keywords: analysisTrackKeywords.hobbies_and_lifestyle,
        custom: false,
    },
    {
        id: 'education',
        code: TRACKS_EDUCATION,
        order: 15,
        labelKey: 'workspace.configOptions.track.education',
        keywords: analysisTrackKeywords.education,
        custom: false,
    },
    {
        id: 'personal_growth',
        code: TRACKS_PERSONAL_GROWTH,
        order: 16,
        labelKey: 'workspace.configOptions.track.personalGrowth',
        keywords: analysisTrackKeywords.personal_growth,
        custom: false,
    },
    {
        id: 'career_and_employment',
        code: TRACKS_CAREER_AND_EMPLOYMENT,
        order: 17,
        labelKey: 'workspace.configOptions.track.careerAndEmployment',
        keywords: analysisTrackKeywords.career_and_employment,
        custom: false,
    },
    {
        id: 'photography_and_design',
        code: TRACKS_PHOTOGRAPHY_AND_DESIGN,
        order: 18,
        labelKey: 'workspace.configOptions.track.photographyAndDesign',
        keywords: analysisTrackKeywords.photography_and_design,
        custom: false,
    },
    {
        id: 'consumer_technology',
        code: TRACKS_CONSUMER_TECHNOLOGY,
        order: 19,
        labelKey: 'workspace.configOptions.track.consumerTechnology',
        keywords: analysisTrackKeywords.consumer_technology,
        custom: false,
    },
    {
        id: 'marriage_and_family',
        code: TRACKS_MARRIAGE_AND_FAMILY,
        order: 20,
        labelKey: 'workspace.configOptions.track.marriageAndFamily',
        keywords: analysisTrackKeywords.marriage_and_family,
        custom: false,
    },
    {
        id: 'gaming_and_anime',
        code: TRACKS_GAMING_AND_ANIME,
        order: 21,
        labelKey: 'workspace.configOptions.track.gamingAndAnime',
        keywords: analysisTrackKeywords.gaming_and_anime,
        custom: false,
    },
    {
        id: 'film_and_entertainment',
        code: TRACKS_FILM_AND_ENTERTAINMENT,
        order: 22,
        labelKey: 'workspace.configOptions.track.filmAndEntertainment',
        keywords: analysisTrackKeywords.film_and_entertainment,
        custom: false,
    },
    {
        id: 'business_and_entrepreneurship',
        code: TRACKS_BUSINESS_AND_ENTREPRENEURSHIP,
        order: 23,
        labelKey: 'workspace.configOptions.track.businessAndEntrepreneurship',
        keywords: analysisTrackKeywords.business_and_entrepreneurship,
        custom: false,
    },
    {
        id: 'automotive_and_mobility',
        code: TRACKS_AUTOMOTIVE_AND_MOBILITY,
        order: 24,
        labelKey: 'workspace.configOptions.track.automotiveAndMobility',
        keywords: analysisTrackKeywords.automotive_and_mobility,
        custom: false,
    },
    {
        id: 'culture_and_humanities',
        code: TRACKS_CULTURE_AND_HUMANITIES,
        order: 25,
        labelKey: 'workspace.configOptions.track.cultureAndHumanities',
        keywords: analysisTrackKeywords.culture_and_humanities,
        custom: false,
    },
    {
        id: 'real_estate',
        code: TRACKS_REAL_ESTATE,
        order: 26,
        labelKey: 'workspace.configOptions.track.realEstate',
        keywords: analysisTrackKeywords.real_estate,
        custom: false,
    },
    {
        id: 'finance_and_investing',
        code: TRACKS_FINANCE_AND_INVESTING,
        order: 27,
        labelKey: 'workspace.configOptions.track.financeAndInvesting',
        keywords: analysisTrackKeywords.finance_and_investing,
        custom: false,
    },
    {
        id: 'science_education',
        code: TRACKS_SCIENCE_EDUCATION,
        order: 28,
        labelKey: 'workspace.configOptions.track.scienceEducation',
        keywords: analysisTrackKeywords.science_education,
        custom: false,
    },
    {
        id: 'law_and_society',
        code: TRACKS_LAW_AND_SOCIETY,
        order: 29,
        labelKey: 'workspace.configOptions.track.lawAndSociety',
        keywords: analysisTrackKeywords.law_and_society,
        custom: false,
    },
    {
        id: 'agriculture_and_rural_life',
        code: TRACKS_AGRICULTURE_AND_RURAL_LIFE,
        order: 30,
        labelKey: 'workspace.configOptions.track.agricultureAndRuralLife',
        keywords: analysisTrackKeywords.agriculture_and_rural_life,
        custom: false,
    },
    {
        id: 'custom',
        code: TRACKS_OTHER,
        order: 31,
        labelKey: 'workspace.configOptions.track.custom',
        keywords: analysisTrackKeywords.custom,
        custom: true,
    },
] as const satisfies readonly AnalysisTrackDefinition[]

const trackById = new Map(analysisTrackCatalog.map((track) => [track.id, track]))

/** 读取已校验赛道定义；目录之外的标识永不降级到其他赛道。 */
export function getAnalysisTrack(trackId: AnalysisTrackId) {
    const track = trackById.get(trackId)
    if (!track) throw new Error('未知分析赛道')
    return track
}

/** 把任务中的稳定赛道标识严格映射到小红书证据编码。 */
export function resolveAnalysisTrackCode(trackId: AnalysisTrackId) {
    return getAnalysisTrack(trackId).code
}

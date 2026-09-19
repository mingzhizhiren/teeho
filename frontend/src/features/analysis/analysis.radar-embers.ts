export interface AnalysisRadarEmber {
    readonly id: string
    readonly x: string
    readonly size: string
    readonly duration: string
    readonly delay: string
    readonly drift: string
    readonly rise: string
    readonly opacity: string
    readonly variant: 'soft' | 'hot' | 'trail'
}

type AnalysisRadarEmberSpec = readonly [
    id: string,
    x: string,
    size: string,
    duration: string,
    delay: string,
    drift: string,
    rise: string,
    opacity: string,
    variant: AnalysisRadarEmber['variant'],
]

const analysisRadarEmberSpecs = [
    ['ember-01', '4%', '2px', '11.8s', '-7.2s', '24px', '330px', '0.56', 'soft'],
    ['ember-02', '9%', '3px', '9.6s', '-2.8s', '-18px', '410px', '0.8', 'hot'],
    ['ember-03', '15%', '1.5px', '13.4s', '-10.1s', '31px', '360px', '0.48', 'soft'],
    ['ember-04', '21%', '2px', '10.7s', '-5.9s', '-26px', '470px', '0.68', 'trail'],
    ['ember-05', '27%', '2.5px', '14.2s', '-12.4s', '16px', '390px', '0.58', 'soft'],
    ['ember-06', '33%', '3px', '8.8s', '-4.3s', '35px', '520px', '0.84', 'hot'],
    ['ember-07', '39%', '1.5px', '12.6s', '-8.5s', '-14px', '440px', '0.52', 'soft'],
    ['ember-08', '45%', '2px', '9.9s', '-1.7s', '21px', '350px', '0.72', 'trail'],
    ['ember-09', '51%', '2.5px', '13.8s', '-11.2s', '-34px', '490px', '0.6', 'soft'],
    ['ember-10', '57%', '3.5px', '10.2s', '-6.6s', '12px', '540px', '0.86', 'hot'],
    ['ember-11', '63%', '1.5px', '14.6s', '-3.4s', '28px', '370px', '0.5', 'soft'],
    ['ember-12', '69%', '2px', '9.2s', '-8.1s', '-22px', '460px', '0.74', 'trail'],
    ['ember-13', '75%', '2.5px', '12.1s', '-5.1s', '32px', '430px', '0.62', 'soft'],
    ['ember-14', '81%', '3px', '8.6s', '-2.2s', '-16px', '510px', '0.82', 'hot'],
    ['ember-15', '87%', '1.5px', '13.1s', '-9.7s', '19px', '340px', '0.46', 'soft'],
    ['ember-16', '93%', '2px', '10.9s', '-6.9s', '-30px', '480px', '0.7', 'trail'],
    ['ember-17', '18%', '2.5px', '14s', '-13.1s', '37px', '560px', '0.54', 'soft'],
    ['ember-18', '36%', '2px', '11.3s', '-7.8s', '-24px', '400px', '0.66', 'soft'],
    ['ember-19', '66%', '3px', '9.4s', '-4.9s', '18px', '530px', '0.8', 'hot'],
    ['ember-20', '84%', '1.5px', '12.9s', '-10.8s', '-36px', '420px', '0.5', 'soft'],
    ['ember-21', '7%', '2.5px', '15.2s', '-12.8s', '-28px', '520px', '0.58', 'soft'],
    ['ember-22', '24%', '1.5px', '10.4s', '-3.7s', '22px', '380px', '0.64', 'trail'],
    ['ember-23', '42%', '3px', '12.8s', '-9.4s', '-18px', '550px', '0.78', 'hot'],
    ['ember-24', '58%', '2px', '14.4s', '-6.2s', '34px', '450px', '0.56', 'soft'],
    ['ember-25', '72%', '1.5px', '11.6s', '-8.9s', '-31px', '390px', '0.6', 'trail'],
    ['ember-26', '90%', '2.5px', '13.6s', '-11.5s', '17px', '500px', '0.7', 'soft'],
    ['ember-27', '12%', '3px', '9.8s', '-5.4s', '30px', '470px', '0.82', 'hot'],
    ['ember-28', '54%', '2px', '15s', '-13.8s', '-25px', '540px', '0.54', 'soft'],
] as const satisfies readonly AnalysisRadarEmberSpec[]

export const analysisRadarEmbers: readonly AnalysisRadarEmber[] = analysisRadarEmberSpecs.map(
    ([id, x, size, duration, delay, drift, rise, opacity, variant]) => ({
        id,
        x,
        size,
        duration,
        delay,
        drift,
        rise,
        opacity,
        variant,
    }),
)

export function analysisRadarEmberStyle(
    ember: AnalysisRadarEmber,
): Readonly<Record<string, string>> {
    return {
        '--ember-x': ember.x,
        '--ember-size': ember.size,
        '--ember-duration': ember.duration,
        '--ember-delay': ember.delay,
        '--ember-drift': ember.drift,
        '--ember-rise': ember.rise,
        '--ember-opacity': ember.opacity,
    }
}

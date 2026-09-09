import type { AppConfig } from '../config.js'
import type { Database } from './database.js'

const users = [
  ['d0000000-0000-4000-8000-000000000001', 'demo.citizen@solvesphere.local', 'Demo Citizen', 'Citizen'],
  ['d0000000-0000-4000-8000-000000000002', 'demo.student1@solvesphere.local', 'Demo Student One', 'Student'],
  ['d0000000-0000-4000-8000-000000000003', 'demo.student2@solvesphere.local', 'Demo Student Two', 'Student'],
  ['d0000000-0000-4000-8000-000000000004', 'demo.mentor@solvesphere.local', 'Demo Mentor', 'Mentor'],
  ['d0000000-0000-4000-8000-000000000005', 'demo.admin@solvesphere.local', 'Demo Admin', 'Admin'],
] as const

const challenges = [
  ['e0000000-0000-4000-8000-000000000001', '[Demo] Safer school road crossings', 'Students need marked crossings and working warning signs near the school gate.', 'Roads & Infrastructure', 'Pune, Maharashtra', 'Implemented', 'High'],
  ['e0000000-0000-4000-8000-000000000002', '[Demo] Community waste sorting point', 'A covered collection point can reduce mixed waste and street litter.', 'Waste Management', 'Pune, Maharashtra', 'Implemented', 'Medium'],
  ['e0000000-0000-4000-8000-000000000003', '[Demo] Repair leaking public water line', 'A recurring leak wastes drinking water and makes the footpath unsafe.', 'Water & Sanitation', 'Pune, Maharashtra', 'In progress', 'High'],
  ['e0000000-0000-4000-8000-000000000004', '[Demo] Restore bus-stop streetlights', 'Several lights around the bus stop are not working after sunset.', 'Public Safety', 'Pune, Maharashtra', 'Published', 'High'],
  ['e0000000-0000-4000-8000-000000000005', '[Demo] Reduce hospital junction congestion', 'Poor lane discipline delays ambulances during peak traffic.', 'Traffic & Mobility', 'Pune, Maharashtra', 'Published', 'Critical'],
  ['e0000000-0000-4000-8000-000000000006', '[Demo] Accessible neighbourhood park', 'Paths and play equipment need repairs for safe and inclusive use.', 'Parks & Accessibility', 'Pune, Maharashtra', 'Rejected', 'Medium'],
  ['e0000000-0000-4000-8000-000000000007', '[Demo] Report damaged public signage', 'Residents need a simple way to map missing or damaged direction signs.', 'Other', 'Pune, Maharashtra', 'Rejected', 'Low'],
] as const

export async function seedDemoData(database: Database, config: AppConfig) {
  if (!config.demoDataEnabled) return
  for (const user of users) await database.query(`insert into profiles(id,email,name,role) values($1,$2,$3,$4) on conflict(id) do nothing`, [...user])
  for (const item of challenges) await database.query(`insert into challenges(id,title,description,category,location,status,priority,readiness,owner_id) values($1,$2,$3,$4,$5,$6,$7,50,$8) on conflict(id) do nothing`, [...item, users[0][0]])
  for (let i = 0; i < 5; i++) {
    const id = `f0000000-0000-4000-8000-00000000000${i + 1}`
    const owner = users[1 + (i % 2)]![0]
    await database.query(`insert into teams(id,name,challenge_id,owner_id) values($1,$2,$3,$4) on conflict(id) do nothing`, [id, `[Demo] Student Team ${i + 1}`, challenges[i]![0], owner])
    await database.query(`insert into team_members(team_id,user_id,member_role) values($1,$2,'Owner') on conflict(team_id,user_id) do nothing`, [id, owner])
  }
  for (let i = 0; i < 3; i++) {
    const solutionId = `a0000000-0000-4000-8000-00000000000${i + 1}`
    const teamId = `f0000000-0000-4000-8000-00000000000${i + 1}`
    const decision = i < 2 ? 'Approved' : 'Changes requested'
    await database.query(`insert into solutions(id,title,description,team_id,created_by,status,submitted_at,reviewed_at) values($1,$2,$3,$4,$5,$6,now(),now()) on conflict(id) do nothing`, [solutionId, `[Demo] Community solution ${i + 1}`, 'Synthetic solution used to demonstrate the review workflow.', teamId, users[1 + (i % 2)]![0], decision])
    await database.query(`insert into solution_reviews(id,solution_id,reviewer_id,decision,feedback) values($1,$2,$3,$4,$5) on conflict(id) do nothing`, [`b0000000-0000-4000-8000-00000000000${i + 1}`, solutionId, users[3]![0], decision, `[Demo review] ${decision === 'Approved' ? 'Ready for admin tracking.' : 'Please improve the implementation details.'}`])
  }
  for (let i = 0; i < 2; i++) await database.query(`insert into challenge_status_history(id,challenge_id,from_status,to_status,reason,changed_by) values($1,$2,'In progress','Implemented','[Demo] Approved by demo admin',$3) on conflict(id) do nothing`, [`c0000000-0000-4000-8000-00000000000${i + 1}`, challenges[i]![0], users[4]![0]])
  for (let i = 0; i < 2; i++) await database.query(`insert into challenge_status_history(id,challenge_id,from_status,to_status,reason,changed_by) values($1,$2,'Under review','Rejected','[Demo] Rejected by demo admin',$3) on conflict(id) do nothing`, [`c0000000-0000-4000-8000-00000000001${i + 1}`, challenges[5 + i]![0], users[4]![0]])
}
